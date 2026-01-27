import { createRouter, createWebHistory } from 'vue-router'
import Chat from '../views/Chat.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'chat',
      component: Chat
    }
  ]
})

export default router
