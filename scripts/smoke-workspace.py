"""Local-only basic smoke. No real model keys; run Wrangler with MOCK_MODEL=true."""
import hashlib
import json
import time
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE='http://127.0.0.1:5177'
API='http://127.0.0.1:8789'
OUT=Path('generated/basic-smoke')
OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,channel='chrome')
    context=browser.new_context(viewport={'width':390,'height':844})
    page=context.new_page()
    page.set_default_timeout(20000)
    page.goto(BASE,wait_until='networkidle')
    page.get_by_role('button',name='创建新账户',exact=True).click()
    page.get_by_label('用户名',exact=True).fill('smoke-'+uuid.uuid4().hex[:10])
    page.get_by_label('密码',exact=True).fill('Local-Only-Smoke-2026!')
    page.get_by_role('button',name='注册账户',exact=True).click()
    page.wait_for_selector('.app-layout')
    page.locator('textarea').fill('请简要介绍这个本地测试。')
    page.locator('button.primary-action.send').click()
    expect(page.locator('.message-row.ai').last).to_contain_text('本地模拟结果',timeout=30000)
    me=context.request.get(API+'/auth/me').json()
    headers={'Origin':BASE,'X-Account-ID':me['user']['id']}
    text='项目名称：本地演示。\n交付日期：2026-09-10。\n负责人：测试账户。'.encode()
    file_id='smoke-'+uuid.uuid4().hex
    chunk=context.request.post(API+'/upload/chunk',headers=headers,multipart={'fileId':file_id,'fileName':'shipping.md','mimeType':'text/markdown','fileSize':str(len(text)),'fileHash':hashlib.md5(text).hexdigest(),'chunkIndex':'0','totalChunks':'1','chunk':{'name':'shipping.md','mimeType':'text/markdown','buffer':text}})
    assert chunk.ok, (chunk.status,chunk.text())
    merged=context.request.post(API+'/upload/complete',headers=headers,data={'fileId':file_id,'fileHash':hashlib.md5(text).hexdigest(),'fileName':'shipping.md','mimeType':'text/markdown'})
    assert merged.ok,(merged.status,merged.text())
    created=context.request.post(API+'/tasks',headers={**headers,'Idempotency-Key':uuid.uuid4().hex},data={'messages':[{'role':'user','content':'交付日期是什么？请引用原文。'}],'files':[merged.json()['file']]})
    assert created.ok,(created.status,created.text())
    task_id=created.json()['task']['id']
    for _ in range(40):
        task=context.request.get(API+'/tasks/'+task_id,headers=headers).json()['task']
        if task['status'] not in ['pending','running']: break
        page.wait_for_timeout(250)
    assert task['status']=='completed', task.get('error')
    assert task['metadata']['sources'] and task['metadata']['sources'][0]['excerpt']
    page.reload(wait_until='networkidle')
    page.locator('.workspace-panel summary').click()
    page.get_by_role('button',name='刷新记录',exact=True).click()
    page.locator('.task-history li').filter(has_text='交付日期').get_by_role('button',name='打开 / 恢复').click()
    expect(page.locator('.message-row.ai').last).to_contain_text('本地模拟结果')
    expect(page.locator('.message-row.ai').last.locator('[data-evidence-source]')).to_have_count(1)
    page.locator('.message-row.ai').last.locator('[data-evidence-source]').click()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    page.screenshot(path=str(OUT/'workspace-390.png'),full_page=True)
    (OUT/'report.json').write_text(json.dumps({'passed':True,'checks':['register-login','mock-chat','owned-upload','durable-file-task','snapshot-sources','reload-open-task','citation-button','390px-overflow'],'realModelCalls':0},indent=2),encoding='utf-8')
    print('PASS basic local smoke: login, chat, file references, task recovery; real model calls=0')
    browser.close()
