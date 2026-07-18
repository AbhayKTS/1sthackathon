const fs = require('fs');
const file = 't:/1sthackathon/frontend/home.html';
let content = fs.readFileSync(file, 'utf8');
const startMarker = '<!-- ===== MAP TIMELINE SECTION ===== -->';
const endMarker = '<section class="treasury" id="treasury">';
const newContent = fs.readFileSync('t:/1sthackathon/frontend/scratch/timeline_snippet.html', 'utf8');

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
    const replaced = content.substring(0, startIndex) + newContent + '\r\n\r\n    ' + content.substring(endIndex);
    fs.writeFileSync(file, replaced);
    console.log('Timeline replaced successfully');
} else {
    console.log('Markers not found', startIndex, endIndex);
}
