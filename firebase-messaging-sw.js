importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
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
    data: { ...d, link: 'https://aceoma.vercel.app/' }
  });
});

// Notificações exibidas pelo SDK (FCM_MSG) são tratadas por ele, que já
// interrompe o evento antes deste handler.
self.addEventListener('notificationclick', event => {
  if (event.notification.data && event.notification.data.FCM_MSG) return;
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link) || 'https://aceoma.vercel.app/';
  event.waitUntil(clients.openWindow(url));
});
