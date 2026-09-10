const fs = require('fs');
let content = fs.readFileSync('src/editorial-opportunity.ts', 'utf8');
content = content.replace(
  `if (!['story', 'illustration', 'testimony', 'narrative'].includes(section.type)) return 'not-a-story';`,
  `const isStory = ['story', 'illustration', 'testimony', 'narrative'].includes(section.type) || (section.secondaryType && ['story', 'illustration', 'testimony', 'narrative'].includes(section.secondaryType));\n  if (!isStory) return 'not-a-story';`
);
fs.writeFileSync('src/editorial-opportunity.ts', content);
