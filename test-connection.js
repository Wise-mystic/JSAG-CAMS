const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

console.log('Attempting to connect to MongoDB...');
console.log('Connection string:', MONGODB_URI);

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => {
    console.log('Successfully connected to MongoDB!');
    process.exit(0);
})
.catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
}); 