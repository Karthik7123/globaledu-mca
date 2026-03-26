const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend files
app.use(express.static(path.join(__dirname, 'public')));

// ================= CLOUD DATABASE CONNECTION =================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Create Tables on the Cloud Database
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY, 
                name TEXT, email TEXT UNIQUE, password TEXT, phone TEXT, plan TEXT DEFAULT 'Free'
            );
            CREATE TABLE IF NOT EXISTS resources (
                id SERIAL PRIMARY KEY, 
                title TEXT, category TEXT, subcategory TEXT, type TEXT, visibility TEXT, author_name TEXT, author_id INTEGER, date TEXT
            );
            CREATE TABLE IF NOT EXISTS comments (
                id SERIAL PRIMARY KEY, 
                resource_id INTEGER, user_name TEXT, comment_text TEXT, date TEXT
            );
        `);
        console.log("✅ Cloud Database Connected and Tables Verified.");
    } catch (err) {
        console.error("❌ Database initialization error:", err);
    }
};
initDB();

// ================= EMAIL & OTP SETUP =================
const otpStorage = new Map(); // Temporarily stores email -> code

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ================= API ENDPOINTS =================

// Register with strict password validation
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    
    // Min 8 chars, 1 letter, 1 number, 1 special char
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: "Password must be at least 8 characters, with 1 letter, 1 number, and 1 special character." });
    }

    try {
        const result = await pool.query(
            `INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email`, 
            [name, email, password]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: "Email already exists" });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(
            `SELECT id, name, email, phone, plan FROM users WHERE email = $1 AND password = $2`, 
            [email, password]
        );
        if (result.rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Forgot Password - Send OTP
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const userCheck = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
        if (userCheck.rows.length === 0) return res.status(404).json({ error: "Email not found" });

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        otpStorage.set(email, code);

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'GlobalEdu - Password Reset Code',
            text: `Your password reset code is: ${code}. Do not share this with anyone.`
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: "Code sent successfully" });
    } catch (err) {
        console.error("Email Error:", err);
        res.status(500).json({ error: "Failed to send email. Check server configuration." });
    }
});

// Reset Password - Verify OTP
app.post('/api/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
        return res.status(400).json({ error: "Password does not meet complexity requirements." });
    }

    const savedCode = otpStorage.get(email);
    if (!savedCode || savedCode !== code) {
        return res.status(400).json({ error: "Invalid or expired code." });
    }

    try {
        await pool.query(`UPDATE users SET password = $1 WHERE email = $2`, [newPassword, email]);
        otpStorage.delete(email);
        res.json({ success: true, message: "Password updated successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Profile
app.put('/api/users/:id', async (req, res) => {
    const { name, email, phone } = req.body;
    try {
        await pool.query(
            `UPDATE users SET name = $1, email = $2, phone = $3 WHERE id = $4`, 
            [name, email, phone, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Resources
app.get('/api/resources', async (req, res) => {
    const userId = req.query.userId;
    try {
        const result = await pool.query(
            `SELECT * FROM resources WHERE visibility = 'public' OR author_id = $1 ORDER BY id DESC`, 
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Upload Resource
app.post('/api/resources', async (req, res) => {
    const { title, category, subcategory, type, visibility, author_name, author_id, date } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO resources (title, category, subcategory, type, visibility, author_name, author_id, date) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, 
            [title, category, subcategory, type, visibility, author_name, author_id, date]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Resource
app.delete('/api/resources/:id', async (req, res) => {
    const { userId } = req.body;
    try {
        const result = await pool.query(
            `DELETE FROM resources WHERE id = $1 AND author_id = $2`, 
            [req.params.id, userId]
        );
        res.json({ success: result.rowCount > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Post Comment
app.post('/api/comments', async (req, res) => {
    const { resource_id, user_name, comment_text, date } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO comments (resource_id, user_name, comment_text, date) VALUES ($1, $2, $3, $4) RETURNING id`, 
            [resource_id, user_name, comment_text, date]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Comments
app.get('/api/comments/:resourceId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM comments WHERE resource_id = $1 ORDER BY id ASC`, 
            [req.params.resourceId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================= SECRET ADMIN ENDPOINT =================
app.get('/api/admin/users', async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, name, email, plan FROM users`);
        let htmlResponse = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>GlobalEdu | Admin Dashboard</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>body { font-family: sans-serif; background-color: #f8fafc; color: #0f172a; }</style>
        </head>
        <body class="p-8 md:p-12">
            <div class="max-w-6xl mx-auto">
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h1 class="text-3xl font-black text-slate-800 tracking-tight">Admin Dashboard</h1>
                    </div>
                    <div class="bg-blue-100 text-blue-800 px-5 py-2.5 rounded-xl font-extrabold text-sm flex items-center gap-2">
                        <span>👥 Total Users:</span>
                        <span class="bg-blue-600 text-white px-2 py-0.5 rounded-lg">${result.rows.length}</span>
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
                                <th class="p-5 font-bold">User ID</th><th class="p-5 font-bold">Full Name</th>
                                <th class="p-5 font-bold">Email Address</th><th class="p-5 font-bold">Plan</th>
                            </tr>
                        </thead>
                        <tbody class="text-sm">`;

        result.rows.forEach(user => {
            const planBadge = user.plan === 'Pro' ? '<span class="bg-purple-100 text-purple-700 px-3 py-1 rounded-md font-bold text-xs border border-purple-200">Pro</span>' : '<span class="bg-slate-100 text-slate-600 px-3 py-1 rounded-md font-bold text-xs border border-slate-200">Free</span>';
            htmlResponse += `
                            <tr class="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                                <td class="p-5 font-bold text-slate-400">#${user.id}</td>
                                <td class="p-5 font-extrabold text-slate-800">${user.name}</td>
                                <td class="p-5 text-slate-600 font-medium">${user.email}</td>
                                <td class="p-5">${planBadge}</td>
                            </tr>`;
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
        </body></html>`;
        res.send(htmlResponse);
    } catch (err) {
        res.status(500).send("Database Error: " + err.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 GlobalEdu Server is running on port ${PORT}`);
});