import fs from 'fs';
import path from 'path';

const dir = './';

function processHtmlFiles(directory) {
    const files = fs.readdirSync(directory);
    
    for (const file of files) {
        const fullPath = path.join(directory, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !fullPath.includes('node_modules') && !fullPath.includes('dist')) {
            processHtmlFiles(fullPath);
        } else if (file.endsWith('.html')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let originalContent = content;

            // Replace image extensions to webp
            content = content.replace(/\.(png|jpg|jpeg)(["'])/gi, '.webp$2');
            
            // Add loading="lazy" to images that don't have it
            // We use a regex to find <img ...> tags
            content = content.replace(/<img\s+([^>]*?)>/gi, (match, attrs) => {
                if (!attrs.includes('loading=')) {
                    // Don't add lazy loading to images that look like they belong to a hero or preloader
                    if (!attrs.includes('class="live-bg-image"') && !attrs.includes('hero')) {
                        return `<img loading="lazy" ${attrs}>`;
                    }
                }
                return match;
            });

            if (content !== originalContent) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log(`Updated ${fullPath}`);
            }
        }
    }
}

processHtmlFiles(dir);
console.log("HTML update complete.");
