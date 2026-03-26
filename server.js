const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite Database
const db = new sqlite3.Database('./globaledu.db', (err) => {
    if (err) console.error("Database connection error: ", err.message);
    console.log('Connected to the SQLite database successfully.');
});

// Create Database Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        name TEXT, 
        email TEXT UNIQUE, 
        password TEXT, 
        phone TEXT, 
        plan TEXT DEFAULT 'Free'
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        title TEXT, 
        category TEXT, 
        subcategory TEXT, 
        type TEXT, 
        visibility TEXT, 
        author_name TEXT, 
        author_id INTEGER, 
        date TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        resource_id INTEGER, 
        user_name TEXT, 
        comment_text TEXT, 
        date TEXT
    )`);
});

// ================= API ENDPOINTS =================

// 1. Auth: Register
app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;
    db.run(`INSERT INTO users (name, email, password) VALUES (?, ?, ?)`, [name, email, password], function(err) {
        if (err) return res.status(400).json({ error: "Email already exists" });
        res.json({ id: this.lastID, name, email });
    });
});

// 2. Auth: Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT id, name, email, phone, plan FROM users WHERE email = ? AND password = ?`, [email, password], (err, user) => {
        if (err || !user) return res.status(401).json({ error: "Invalid credentials" });
        res.json(user);
    });
});

// 3. User: Update Profile
app.put('/api/users/:id', (req, res) => {
    const { name, email, phone } = req.body;
    db.run(`UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?`, [name, email, phone, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 4. Resources: Get All (Public OR Owned by logged-in user)
app.get('/api/resources', (req, res) => {
    const userId = req.query.userId;
    db.all(`SELECT * FROM resources WHERE visibility = 'public' OR author_id = ? ORDER BY id DESC`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 5. Resources: Upload
app.post('/api/resources', (req, res) => {
    const { title, category, subcategory, type, visibility, author_name, author_id, date } = req.body;
    db.run(`INSERT INTO resources (title, category, subcategory, type, visibility, author_name, author_id, date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
        [title, category, subcategory, type, visibility, author_name, author_id, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

// 6. Resources: Delete
app.delete('/api/resources/:id', (req, res) => {
    const { userId } = req.body;
    db.run(`DELETE FROM resources WHERE id = ? AND author_id = ?`, [req.params.id, userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: this.changes > 0 });
    });
});

// 7. Comments: Add
app.post('/api/comments', (req, res) => {
    const { resource_id, user_name, comment_text, date } = req.body;
    db.run(`INSERT INTO comments (resource_id, user_name, comment_text, date) VALUES (?, ?, ?, ?)`, 
        [resource_id, user_name, comment_text, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

// 8. Comments: Get by Resource ID
app.get('/api/comments/:resourceId', (req, res) => {
    db.all(`SELECT * FROM comments WHERE resource_id = ? ORDER BY id ASC`, [req.params.resourceId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🚀 GlobalEdu Server is running!`);
    console.log(`👉 Open your browser to: http://localhost:${PORT}`);
    console.log(`=========================================\n`);
});