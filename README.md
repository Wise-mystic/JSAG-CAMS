# CAMS Backend - Church Attendance Management System

A comprehensive backend system for managing church attendance, events, departments, and member engagement.

## 🚀 Features

- **Multi-role Authentication**: Phone-based OTP registration with JWT tokens
- **Hierarchical Role Management**: 7 distinct roles with proper permission inheritance
- **Organization Management**: Departments, Ministries, Prayer Tribes with complex rules
- **Event Management**: Event creation, scheduling, and participant management
- **Attendance Tracking**: Real-time marking, bulk operations, and auto-closure
- **Advanced Analytics**: Role-specific dashboards and reporting
- **SMS Notifications**: Event reminders and custom notifications
- **Audit Trail**: Complete action logging for compliance

## 📋 Prerequisites

- Node.js 18+ 
- MongoDB 5.0+
- Redis 6.0+
- npm or pnpm package manager

## 🛠️ Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd backend
```

2. **Install dependencies**
```bash
npm install
# or
pnpm install
```

3. **Environment Setup**

Create a `.env` file in the backend directory with the following variables:

```env
# Server Configuration
NODE_ENV=development
PORT=5000

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/cams_db

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-super-secret-refresh-key
JWT_EXPIRE=90m
JWT_REFRESH_EXPIRE=7d

# SMS Configuration (SMSnotifyGh)
SMS_API_KEY=your-smsnotifygh-api-key
SMS_SENDER_ID=CAMS
SMS_BASE_URL=https://smsnotifygh.com/api/v1

# Other configurations...
```

4. **Start MongoDB and Redis**

Make sure MongoDB and Redis are running on your system:

```bash
# Start MongoDB
mongod

# Start Redis
redis-server
```

5. **Run the application**

```bash
# Development mode
npm run dev

# Production mode
npm start
```

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/           # Configuration files
│   ├── controllers/      # Route controllers
│   ├── middleware/       # Express middleware
│   ├── models/          # Mongoose schemas
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   ├── jobs/            # Background jobs
│   ├── utils/           # Utility functions
│   └── server.js        # App entry point
├── tests/               # Test files
├── docs/               # API documentation
└── logs/               # Application logs
```

## 🔑 API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/verify-otp` - Verify OTP
- `POST /api/v1/auth/login` - Login with phone & password
- `POST /api/v1/auth/refresh-token` - Refresh access token
- `POST /api/v1/auth/logout` - Logout user

### User Management
- `GET /api/v1/users` - List users (paginated)
- `POST /api/v1/users` - Create new user
- `GET /api/v1/users/:id` - Get user details
- `PUT /api/v1/users/:id` - Update user
- `DELETE /api/v1/users/:id` - Delete user

### Event Management
- `GET /api/v1/events` - List events
- `POST /api/v1/events` - Create event
- `GET /api/v1/events/:id` - Get event details
- `PUT /api/v1/events/:id` - Update event
- `DELETE /api/v1/events/:id` - Delete event

### Attendance
- `GET /api/v1/attendance/event/:eventId` - Get event attendance
- `POST /api/v1/attendance/mark` - Mark attendance
- `POST /api/v1/attendance/bulk-mark` - Bulk attendance marking

## 👥 User Roles

1. **Super Admin**: Complete system access
2. **Senior Pastor**: Church-wide view and analytics
3. **Associate Pastor**: Role management and coordination
4. **Pastor**: Member care and ministry events
5. **Department Leader**: Department management
6. **Clocker**: Scoped event creation and attendance
7. **Member**: Personal profile and attendance

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## 📊 Database Schema

### Core Collections:
- **Users**: Member profiles with roles and assignments
- **Departments**: Organizational units with hierarchy
- **Events**: Church events and services
- **Attendance**: Attendance records
- **Ministries**: Ministry groups within departments
- **PrayerTribes**: Day-based prayer groups
- **AuditLogs**: System action logs
- **Notifications**: SMS notification tracking

## 🔒 Security

- JWT-based authentication with refresh tokens
- Phone number verification via OTP
- Role-based access control (RBAC)
- Rate limiting on all endpoints
- Input validation and sanitization
- Audit logging for sensitive operations

## 🚦 Health Checks

- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system status

## 📝 Environment Variables

See `.env.example` for all available configuration options.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For support and questions, please contact the development team.

---

Built with ❤️ for church communities 