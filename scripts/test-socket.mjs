import { io } from 'socket.io-client';

const URL = 'http://localhost:4002';

// Seed data stable firebase UIDs
const BUYER_UID = 'test-buyer-001'; // Vikram Mehta, technology
const PROVIDER_UID = 'test-provider-001'; // TechVault Solutions, technology

console.log('🧪 Starting Socket.IO Matching Engine Test...');

const buyerSocket = io(URL);
const providerSocket = io(URL);

let matchId = null;

buyerSocket.on('connect', () => {
  console.log('🟢 Buyer connected');
  buyerSocket.emit('join:room', {
    userId: BUYER_UID,
    role: 'buyer',
    industry: 'technology',
  });
});

providerSocket.on('connect', () => {
  console.log('🟢 Provider connected');
  providerSocket.emit('join:room', {
    userId: PROVIDER_UID,
    role: 'provider',
    industry: 'technology',
  });
});

buyerSocket.on('match:found', (data) => {
  console.log(`🎉 Buyer matched with: ${data.partner.displayName}`);
  matchId = data.matchId;
  
  // Buyer says hi
  buyerSocket.emit('chat:send', {
    matchId,
    content: 'Hi, I need an ERP migration!',
    type: 'text',
  });
});

providerSocket.on('match:found', (data) => {
  console.log(`🎉 Provider matched with: ${data.partner.displayName}`);
  matchId = data.matchId;
});

providerSocket.on('chat:received', (data) => {
  console.log(`💬 Provider received message: "${data.message.content}"`);
  
  // Provider saves the match
  console.log('💾 Provider saving match...');
  providerSocket.emit('match:save', { matchId });
});

providerSocket.on('match:saved', (data) => {
  // Not triggered for self, only partner
});

buyerSocket.on('match:saved', (data) => {
  console.log('💾 Buyer saw provider save the match! Buyer saving too...');
  buyerSocket.emit('match:save', { matchId });
});

buyerSocket.on('deal:created', (data) => {
  console.log(`🤝 DEAL CREATED (Buyer Side)! Deal Room ID: ${data.dealRoomId}`);
});

providerSocket.on('deal:created', (data) => {
  console.log(`🤝 DEAL CREATED (Provider Side)! Deal Room ID: ${data.dealRoomId}`);
  
  // Test complete!
  console.log('✅ End-to-end Socket Test Complete!');
  setTimeout(() => {
    buyerSocket.disconnect();
    providerSocket.disconnect();
    process.exit(0);
  }, 1000);
});

buyerSocket.on('error', (err) => console.error('❌ Buyer Error:', err));
providerSocket.on('error', (err) => console.error('❌ Provider Error:', err));

// Timeout failsafe
setTimeout(() => {
  console.error('⏰ Test timed out');
  buyerSocket.disconnect();
  providerSocket.disconnect();
  process.exit(1);
}, 10000);

