import dotenv from 'dotenv';

dotenv.config();

import app from './express.js';

const PORT = process.env.EXPRESS_PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});