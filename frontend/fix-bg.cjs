const fs = require('fs');
let html = fs.readFileSync('t:/1sthackathon/frontend/landing.html', 'utf8');
const startStr = '<div class="tracks-background"';
const endStr = '<div class="tracks-container">';
const startIndex = html.indexOf(startStr);
const endIndex = html.indexOf(endStr);
if (startIndex !== -1 && endIndex !== -1) {
    html = html.substring(0, startIndex) + html.substring(endIndex);
    fs.writeFileSync('t:/1sthackathon/frontend/landing.html', html);
    console.log('Replaced HTML block');
} else {
    console.log('Not found in HTML');
}
