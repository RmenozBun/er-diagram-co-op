import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import './style.css'
import App from './App.vue'

const saved = (() => {
  try {
    return localStorage.getItem('er-theme')
  } catch {
    return null
  }
})()
const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches

const vuetify = createVuetify({
  theme: {
    defaultTheme: saved ?? (prefersDark ? 'dark' : 'light'),
    themes: {
      light: { colors: { primary: '#2563eb', secondary: '#0d9488', surface: '#ffffff', background: '#f6f7f9' } },
      dark: { dark: true, colors: { primary: '#60a5fa', secondary: '#2dd4bf', surface: '#23262b', background: '#1b1d21' } },
    },
  },
})

createApp(App).use(vuetify).mount('#app')
