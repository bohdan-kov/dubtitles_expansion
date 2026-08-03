import { createApp } from 'vue';

import App from './App.vue';
import './styles/globals.css';

// Follow the OS/browser colour scheme: shadcn's dark palette hangs off a
// `.dark` class on <html>, so mirror the media query onto it.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', darkQuery.matches);
applyTheme();
darkQuery.addEventListener('change', applyTheme);

createApp(App).mount('#app');
