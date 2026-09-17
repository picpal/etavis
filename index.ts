import { registerRootComponent } from 'expo';

import App from './App';

/* 웹 전용 프레임. document 가 있을 때만 읽는다 — 네이티브 번들에는 .css 로더가 없다 */
if (typeof document !== 'undefined') require('./src/webFrame.css');

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
