const fs = require('fs');
let css = fs.readFileSync('t:/1sthackathon/frontend/css/style.css', 'utf8');

css = css.replace('.tracks-section {\r\n    position: relative;\r\n    min-height: 100vh;\r\n    padding: 120px 20px 60px;\r\n    overflow: hidden;\r\n}', '.tracks-section {\r\n    position: relative;\r\n    min-height: 100vh;\r\n    padding: 120px 20px 60px;\r\n    overflow: hidden;\r\n    background: linear-gradient(180deg, #1b0518 0%, #0f0710 100%);\r\n}');

// Fallback if \n instead of \r\n
if (!css.includes('linear-gradient(180deg, #1b0518 0%, #0f0710 100%)')) {
    css = css.replace('.tracks-section {\n    position: relative;\n    min-height: 100vh;\n    padding: 120px 20px 60px;\n    overflow: hidden;\n}', '.tracks-section {\n    position: relative;\n    min-height: 100vh;\n    padding: 120px 20px 60px;\n    overflow: hidden;\n    background: linear-gradient(180deg, #1b0518 0%, #0f0710 100%);\n}');
}

css = css.replace('.map-timeline {\r\n    position: relative;\r\n    width: 100%;\r\n    height: 100vh;\r\n    margin-top: 0;\r\n    min-height: 600px;\r\n    overflow: hidden;\r\n    display: flex;\r\n    flex-direction: column;\r\n    align-items: center;\r\n    justify-content: flex-start;\r\n', '.map-timeline {\r\n    position: relative;\r\n    width: 100%;\r\n    height: 100vh;\r\n    margin-top: 0;\r\n    min-height: 600px;\r\n    overflow: hidden;\r\n    display: flex;\r\n    flex-direction: column;\r\n    align-items: center;\r\n    justify-content: flex-start;\r\n    background: linear-gradient(180deg, #1b0518 0%, #0f0710 100%);\r\n');

if (css.indexOf('.map-timeline {') !== -1 && !css.includes('background: linear-gradient(180deg, #1b0518 0%, #0f0710 100%);')) {
    css = css.replace('.map-timeline {\n    position: relative;\n    width: 100%;\n    height: 100vh;\n    margin-top: 0;\n    min-height: 600px;\n    overflow: hidden;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: flex-start;\n', '.map-timeline {\n    position: relative;\n    width: 100%;\n    height: 100vh;\n    margin-top: 0;\n    min-height: 600px;\n    overflow: hidden;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: flex-start;\n    background: linear-gradient(180deg, #1b0518 0%, #0f0710 100%);\n');
}

fs.writeFileSync('t:/1sthackathon/frontend/css/style.css', css);
console.log('Replaced CSS block');
