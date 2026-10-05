importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Mesma tabela de ambientes do index.html (functions/test/environments-test.js confere que batem):
// a produção é o padrão; o site de TESTE tem projeto Firebase próprio.
const STAGING_HOSTS = ['seriebaceoma-staging.web.app', 'seriebaceoma-staging.firebaseapp.com'];
const IS_STAGING = STAGING_HOSTS.includes(self.location.hostname);
const PUSH_URL = IS_STAGING ? 'https://seriebaceoma-staging.web.app/' : 'https://aceoma.vercel.app/';

firebase.initializeApp(IS_STAGING ? {
  apiKey: "AIzaSyCGFnKi786IpFoklZK_Bn80MpXrgCFiAEg",
  authDomain: "seriebaceoma-staging.firebaseapp.com",
  projectId: "seriebaceoma-staging",
  storageBucket: "seriebaceoma-staging.firebasestorage.app",
  messagingSenderId: "378210094171",
  appId: "1:378210094171:web:b2173e3a1d1a751884037e"
} : {
  apiKey: "AIzaSyAp8LdT0n6Sg3cipCeZZPVZdCwoa7eOogg",
  authDomain: "seriebaceoma.firebaseapp.com",
  projectId: "seriebaceoma",
  storageBucket: "seriebaceoma.firebasestorage.app",
  messagingSenderId: "354275671624",
  appId: "1:354275671624:web:e2318f3726e6c9487b627d"
});

const messaging = firebase.messaging();

// Instala a versão nova do worker na hora, sem esperar todas as abas fecharem
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(clients.claim()));

// O SDK do Firebase já exibe sozinho toda mensagem que traz "notification"
// (é o caso de todas as enviadas pelas Cloud Functions). Exibir de novo aqui
// duplicava a notificação, então só tratamos mensagens "data-only".
messaging.onBackgroundMessage(payload => {
  if (payload.notification) return;
  const d = payload.data || {};
  self.registration.showNotification(d.title || 'Aceoma', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    data: { ...d, link: PUSH_URL }
  });
});

// Notificações exibidas pelo SDK (FCM_MSG) são tratadas por ele, que já
// interrompe o evento antes deste handler.
self.addEventListener('notificationclick', event => {
  if (event.notification.data && event.notification.data.FCM_MSG) return;
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link) || PUSH_URL;
  event.waitUntil(clients.openWindow(url));
});
