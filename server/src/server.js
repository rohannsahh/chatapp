const http = require('http');
const socketIo = require('socket.io');
const redis = require('redis');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const server = http.createServer();
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Create a Redis client and connect to the Redis server running in Docker
const redisClient = redis.createClient({
  socket: {
    host: 'localhost',
    port: 6379
  }
});

redisClient.connect().catch(console.error);

// Set up DOMPurify
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('joinQueue', async (type) => {
    console.log(`User joined the ${type} queue:`, socket.id);

    if (type === 'venter') {
      await redisClient.lPush('venters', socket.id);
    } else if (type === 'listener') {
      await redisClient.lPush('listeners', socket.id);
    }

    const ventersLength = await redisClient.lLen('venters');
    const listenersLength = await redisClient.lLen('listeners');

    if (ventersLength > 0 && listenersLength > 0) {
      const venter = await redisClient.rPop('venters');
      const listener = await redisClient.rPop('listeners');
      const room = `room-${venter}-${listener}`;

      io.to(venter).socketsJoin(room);
      io.to(listener).socketsJoin(room);

      io.to(venter).emit('roomJoined', room);
      io.to(listener).emit('roomJoined', room);

      console.log(`Paired venter ${venter} and listener ${listener} in room ${room}`);
    }
  });

  socket.on('joinRoom', (room) => {
    socket.join(room);
  });

  socket.on('message', ({ room, message }) => {
    // Sanitize the message
    const sanitizedMessage = DOMPurify.sanitize(message);
    console.log(`Message received in room ${room}: ${sanitizedMessage}`);
    io.to(room).emit('message', sanitizedMessage);
  });

  socket.on('leaveRoom', (room) => {
    socket.leave(room);
    console.log(`User left room: ${room}`);
    // Handle any additional cleanup here if necessary
  });

  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id);
    await redisClient.lRem('venters', 0, socket.id);
    await redisClient.lRem('listeners', 0, socket.id);
  });
});

server.listen(8080, () => {
  console.log('Socket.IO server is running on http://localhost:8080');
});
