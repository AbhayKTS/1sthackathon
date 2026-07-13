import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const directoryToSearch = './assets';

async function optimizeImages(dir) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            await optimizeImages(fullPath);
        } else if (file.match(/\.(png|jpg|jpeg)$/i)) {
            const ext = path.extname(file);
            const webpPath = fullPath.replace(new RegExp(`${ext}$`, 'i'), '.webp');
            
            // Skip if webp already exists
            if (!fs.existsSync(webpPath)) {
                console.log(`Optimizing: ${fullPath} -> ${webpPath}`);
                try {
                    await sharp(fullPath)
                        .webp({ quality: 80, effort: 6 })
                        .toFile(webpPath);
                    console.log(`Successfully created ${webpPath}`);
                } catch (err) {
                    console.error(`Error processing ${fullPath}:`, err);
                }
            }
        }
    }
}

optimizeImages(directoryToSearch).then(() => {
    console.log('Image optimization complete.');
}).catch(console.error);
