// server.js

const express = require('express');
const { neon } = require('@neondatabase/serverless');
const cors = require('cors');
const multer = require('multer'); 
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- KONFIGURASI UMUM ---

// Konfigurasi CORS: Izinkan akses dari port frontend dan admin (misal: 5500, 8080)
app.use(cors({
    origin: ['http://localhost:8080', 'http://127.0.0.1:5500', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// Konfigurasi Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Konfigurasi Multer (menggunakan memory storage)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Inisialisasi klien Neon
const sql = neon(process.env.DATABASE_URL);


// --- ENDPOINT PUBLIC (READ) ---

app.get('/api/projects', async (req, res) => {
    try {
        // Pastikan query rapi tanpa spasi di awal template literal
        const projects = await sql`
SELECT id, title, description, image_url
FROM projects
ORDER BY created_at DESC;
`;
        res.json(projects);
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Failed to retrieve project data.' });
    }
});


// --- ENDPOINT ADMIN (CRUD) ---

/**
 * 1. CREATE Project (POST)
 */
app.post('/api/admin/projects', upload.single('image'), async (req, res) => {
    try {
        const { title, description } = req.body;
        const file = req.file;

        if (!title || !description || !file) {
            return res.status(400).json({ error: 'Title, description, and image are required.' });
        }

        // 1. Upload ke Cloudinary (Folder: nan_pic)
        const result = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`, {
            folder: 'nan_pic', 
        });
        const imageUrl = result.secure_url;

        // 2. Simpan ke Database Neon
        const newProject = await sql`
INSERT INTO projects (title, description, image_url, created_at)
VALUES (${title}, ${description}, ${imageUrl}, NOW())
RETURNING id, title, image_url;
`;

        res.status(201).json({ 
            message: 'Project created successfully', 
            project: newProject[0] 
        });

    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: 'Failed to create project.' });
    }
});

/**
 * 2. UPDATE Project (PUT)
 */
app.put('/api/admin/projects/:id', upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, existing_image_url } = req.body;
        const file = req.file;
        let imageUrl = existing_image_url;

        if (!title || !description) {
            return res.status(400).json({ error: 'Title and description are required.' });
        }

        // Jika ada file baru diupload
        if (file) {
            // Hapus gambar lama jika ada
            if (existing_image_url) {
                const publicIdMatch = existing_image_url.match(/nan_pic\/([^\.]+)/);
                if (publicIdMatch && publicIdMatch[1]) {
                    await cloudinary.uploader.destroy(`nan_pic/${publicIdMatch[1]}`);
                }
            }

            // Upload gambar baru ke folder 'nan_pic'
            const result = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`, {
                folder: 'nan_pic',
            });
            imageUrl = result.secure_url;
        }

        // Update di Database
        const updatedProject = await sql`
UPDATE projects
SET title = ${title}, 
    description = ${description}, 
    image_url = ${imageUrl}
WHERE id = ${parseInt(id)}
RETURNING id, title, image_url;
`;

        if (updatedProject.length === 0) {
            return res.status(404).json({ error: 'Project not found.' });
        }

        res.json({ message: 'Project updated successfully', project: updatedProject[0] });

    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({ error: 'Failed to update project.' });
    }
});

/**
 * 3. DELETE Project (DELETE)
 */
app.delete('/api/admin/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Ambil URL gambar lama 
        const [project] = await sql`
SELECT image_url FROM projects WHERE id = ${parseInt(id)};
`;

        if (!project) {
            return res.status(404).json({ error: 'Project not found.' });
        }

        // 2. Hapus dari Database
        await sql`
DELETE FROM projects WHERE id = ${parseInt(id)};
`;

        // 3. Hapus gambar dari Cloudinary
        if (project.image_url) {
            const publicIdMatch = project.image_url.match(/nan_pic\/([^\.]+)/);
            if (publicIdMatch && publicIdMatch[1]) {
                await cloudinary.uploader.destroy(`nan_pic/${publicIdMatch[1]}`);
            }
        }

        res.json({ message: 'Project deleted successfully' });

    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project.' });
    }
});


// Endpoint dasar
app.get('/', (req, res) => {
    res.send('Portfolio Backend API is running.');
});

module.exports = app;
