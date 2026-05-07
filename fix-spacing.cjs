const fs = require('fs');
let f = fs.readFileSync('src/components/LandingPage.jsx', 'utf8');

f = f.replace(/\b(gap-|p-|px-|py-|m-|mx-|my-|mt-|mb-|ml-|mr-|space-y-|space-x-)xl\b/g, '$110');
f = f.replace(/\b(gap-|p-|px-|py-|m-|mx-|my-|mt-|mb-|ml-|mr-|space-y-|space-x-)lg\b/g, '$16');
f = f.replace(/\b(gap-|p-|px-|py-|m-|mx-|my-|mt-|mb-|ml-|mr-|space-y-|space-x-)md\b/g, '$14');
f = f.replace(/\b(gap-|p-|px-|py-|m-|mx-|my-|mt-|mb-|ml-|mr-|space-y-|space-x-)sm\b/g, '$12');
f = f.replace(/\b(gap-|p-|px-|py-|m-|mx-|my-|mt-|mb-|ml-|mr-|space-y-|space-x-)xs\b/g, '$11');
f = f.replace(/\bmax-w-xl\b/g, 'max-w-[40rem]'); // restore the old max-w-xl
f = f.replace(/\bmax-w-lg\b/g, 'max-w-[32rem]'); // restore the old max-w-lg
f = f.replace(/\bmax-w-md\b/g, 'max-w-[28rem]'); // restore the old max-w-md

fs.writeFileSync('src/components/LandingPage.jsx', f);
console.log('done');
