import { mount } from 'svelte';
import App from './App.svelte';
import '$shared/global.css';

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
