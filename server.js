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
// ================= SECRET ADMIN ENDPOINT =================
// See all registered users with an attractive, interactive UI
app.get('/api/admin/users', (req, res) => {
    db.all(`SELECT id, name, email, plan FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        let htmlResponse = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>GlobalEdu | Admin Dashboard</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                body { font-family: sans-serif; background-color: #f8fafc; color: #0f172a; }
                .brand-gradient { background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); }
            </style>
        </head>
        <body class="p-8 md:p-12">
            <div class="max-w-6xl mx-auto">
                
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h1 class="text-3xl font-black text-slate-800 tracking-tight">Admin Dashboard</h1>
                        <p class="text-slate-500 font-medium mt-1">Manage your GlobalEdu users and platform data.</p>
                    </div>
                    <div class="bg-blue-100 text-blue-800 px-5 py-2.5 rounded-xl font-extrabold text-sm shadow-sm flex items-center gap-2">
                        <span>👥 Total Registered Users:</span>
                        <span class="bg-blue-600 text-white px-2 py-0.5 rounded-lg">${rows.length}</span>
                    </div>
                </div>

                <div class="mb-6">
                    <input type="text" id="searchInput" onkeyup="searchTable()" placeholder="🔍 Search by name or email..." 
                           class="w-full md:w-1/3 p-3.5 bg-white border border-slate-200 rounded-xl shadow-sm outline-none focus:ring-2 focus:ring-blue-500 transition font-medium text-sm">
                </div>

                <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <table class="w-full text-left border-collapse" id="userTable">
                        <thead>
                            <tr class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                                <th class="p-5 font-bold">User ID</th>
                                <th class="p-5 font-bold">Full Name</th>
                                <th class="p-5 font-bold">Email Address</th>
                                <th class="p-5 font-bold">Subscription Plan</th>
                                <th class="p-5 font-bold">Storage Limit</th>
                            </tr>
                        </thead>
                        <tbody class="text-sm">
        `;

        // Loop through the database rows and create table rows
        rows.forEach(user => {
            // Create a nice visual badge for the subscription plan
            const planBadge = user.plan === 'Pro' 
                ? '<span class="bg-purple-100 text-purple-700 px-3 py-1 rounded-md font-bold text-xs border border-purple-200">Pro</span>' 
                : '<span class="bg-slate-100 text-slate-600 px-3 py-1 rounded-md font-bold text-xs border border-slate-200">Free</span>';

            htmlResponse += `
                            <tr class="hover:bg-slate-50 transition border-b border-slate-100 last:border-0">
                                <td class="p-5 font-bold text-slate-400">#${user.id}</td>
                                <td class="p-5 font-extrabold text-slate-800">${user.name}</td>
                                <td class="p-5 text-slate-600 font-medium">${user.email}</td>
                                <td class="p-5">${planBadge}</td>
                                <td class="p-5 text-slate-500 font-medium">1 GB</td>
                            </tr>
            `;
        });

        htmlResponse += `
                        </tbody>
                    </table>
                </div>
            </div>

            <script>
                function searchTable() {
                    const input = document.getElementById("searchInput");
                    const filter = input.value.toLowerCase();
                    const table = document.getElementById("userTable");
                    const tr = table.getElementsByTagName("tr");

                    for (let i = 1; i < tr.length; i++) {
                        const tdName = tr[i].getElementsByTagName("td")[1];
                        const tdEmail = tr[i].getElementsByTagName("td")[2];
                        
                        if (tdName || tdEmail) {
                            const nameValue = tdName.textContent || tdName.innerText;
                            const emailValue = tdEmail.textContent || tdEmail.innerText;
                            
                            if (nameValue.toLowerCase().indexOf(filter) > -1 || emailValue.toLowerCase().indexOf(filter) > -1) {
                                tr[i].style.display = "";
                            } else {
                                tr[i].style.display = "none";
                            }
                        }
                    }
                }
            </script>
        </body>
        </html>
        `;

        res.send(htmlResponse);
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🚀 GlobalEdu Server is running!`);
    console.log(`👉 Open your browser to: http://localhost:${PORT}`);
    console.log(`=========================================\n`);
});
