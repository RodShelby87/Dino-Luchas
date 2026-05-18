const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);

// CONFIGURACIÓN ANTI-DESCONEXIÓN: Latidos cada 15 segundos para mantener vivo a Render
const io = new Server(server, { 
    cors: { origin: "*" },
    pingInterval: 15000,
    pingTimeout: 30000 
});

const rooms = {}; 

function checkWinner(move1, move2) {
    if (move1 === move2) return 'NONE';
    if (move1.startsWith('D') && move2.startsWith('D')) return 'NONE'; 
    if ((move1 === 'AA' && move2 === 'AB') || (move1 === 'AB' && move2 === 'AA')) return 'BOTH';
    if (move1 === 'AA' && move2 === 'DB') return 'P1';
    if (move2 === 'AA' && move1 === 'DB') return 'P2';
    if (move1 === 'AB' && move2 === 'DA') return 'P1';
    if (move2 === 'AB' && move1 === 'DA') return 'P2';
    if (move1 === 'AA' && move2 === 'DA') return 'P2';
    if (move2 === 'AA' && move1 === 'DA') return 'P1';
    if (move1 === 'AB' && move2 === 'DB') return 'P2';
    if (move2 === 'AB' && move1 === 'DB') return 'P1';
    return 'NONE';
}

io.on('connection', (socket) => {
    socket.emit('update_lobby', Object.keys(rooms).filter(r => rooms[r].players.length === 1));

    socket.on('create_room', () => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomId] = {
            id: roomId,
            players: [{ id: socket.id, color: 'Rojo', tracks: { AA: 0, AB: 0, DA: 0, DB: 0 }, available: ['AA', 'AB', 'DA', 'DB'] }],
            moves: {}
        };
        socket.join(roomId);
        socket.emit('room_created', roomId);
        io.emit('update_lobby', Object.keys(rooms).filter(r => rooms[r].players.length === 1));
    });

    socket.on('join_room', (roomId) => {
        if (rooms[roomId] && rooms[roomId].players.length === 1) {
            rooms[roomId].players.push({ id: socket.id, color: 'Azul', tracks: { AA: 0, AB: 0, DA: 0, DB: 0 }, available: ['AA', 'AB', 'DA', 'DB'] });
            socket.join(roomId);
            io.to(roomId).emit('game_start', rooms[roomId]);
            io.emit('update_lobby', Object.keys(rooms).filter(r => rooms[r].players.length === 1));
        } else {
            socket.emit('error_msg', 'La sala no existe o está llena.');
        }
    });

    // AHORA RECIBIMOS EL COLOR PARA EVITAR BUGS DE DESCONEXIÓN
    socket.on('play_card', ({ roomId, color, card }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        room.moves[color] = card;

        if (Object.keys(room.moves).length === 2) {
            const p1 = room.players[0]; // Rojo
            const p2 = room.players[1]; // Azul
            const move1 = room.moves['Rojo'];
            const move2 = room.moves['Azul'];

            const result = checkWinner(move1, move2);
            let roundWinner = result;

            if (result === 'P1' || result === 'BOTH') p1.tracks[move1]++;
            if (result === 'P2' || result === 'BOTH') p2.tracks[move2]++;

            const p1Wins = Object.values(p1.tracks).some(t => t >= 3);
            const p2Wins = Object.values(p2.tracks).some(t => t >= 3);
            
            let gameWinner = null;
            if (p1Wins && p2Wins) gameWinner = 'TIE_GAME';
            else if (p1Wins) gameWinner = 'P1_WINS';
            else if (p2Wins) gameWinner = 'P2_WINS';

            if (result === 'NONE') {
                p1.available = p1.available.filter(c => c !== move1);
                p2.available = p2.available.filter(c => c !== move2);
                if (p1.available.length === 0) {
                    p1.available = ['AA', 'AB', 'DA', 'DB'];
                    p2.available = ['AA', 'AB', 'DA', 'DB'];
                }
            } else {
                p1.available = ['AA', 'AB', 'DA', 'DB'];
                p2.available = ['AA', 'AB', 'DA', 'DB'];
            }

            io.to(roomId).emit('round_result', {
                p1Move: move1, p2Move: move2, roundWinner, gameWinner, roomState: room
            });

            room.moves = {};
            if (gameWinner) delete rooms[roomId];
        }
    });

    socket.on('surrender', (roomId) => {
        if (rooms[roomId]) {
            socket.to(roomId).emit('opponent_surrendered');
            delete rooms[roomId];
            io.emit('update_lobby', Object.keys(rooms).filter(r => rooms[r].players.length === 1));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
