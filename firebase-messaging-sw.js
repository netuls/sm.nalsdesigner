// firebase-messaging-sw.js
// Service Worker para receber notificações push em background (iOS e Android)
// A configuração do Firebase vem do config.js (não precisa editar aqui).

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
importScripts('./config.js');

firebase.initializeApp(BARBEARIA.firebase);

const messaging = firebase.messaging();

// Recebe e exibe notificações quando o app está em background ou fechado
messaging.onBackgroundMessage(payload => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || 'Novo Agendamento', {
    body: body || 'Um cliente acabou de agendar!',
    icon: icon || './logo_512.png',
    badge: './logo_192.png',
    vibrate: [200, 100, 200],
    tag: 'novo-agendamento',
    renotify: true,
    data: payload.data || {}
  });
});

// Ao clicar na notificação, abre o painel admin
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('admin') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./admin.html');
    })
  );
});
