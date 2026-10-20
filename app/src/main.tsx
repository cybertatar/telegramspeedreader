import { render } from 'preact';
import { initTelegram } from './telegram';
import { App } from './ui/App';
import { watchForUpdates } from './update';
import './styles.css';

initTelegram();
watchForUpdates();
render(<App />, document.getElementById('app')!);
