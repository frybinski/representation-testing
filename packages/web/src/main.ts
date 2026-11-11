import { mountApp } from './app.ts';
import './styles.css';
import { tokensCss } from './tokens.ts';

const style = document.createElement('style');
style.textContent = tokensCss();
document.head.prepend(style);

const root = document.getElementById('app');
if (!root) throw new Error('#app is missing');
mountApp(root);
