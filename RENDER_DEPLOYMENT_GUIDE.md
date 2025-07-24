# CAMS Backend - Render Deployment Guide

## 🚀 Quick Setup

### 1. Required Environment Variables

Set these environment variables in your Render service dashboard:

#### **Essential Variables (Required)**
```env
# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/cams_db

# Security
JWT_SECRET=your-super-secure-jwt-secret-here
JWT_REFRESH_SECRET=your-super-secure-refresh-secret-here

# SMS Service (for notifications)
SMS_API_KEY=your-sms-api-key

# Server
NODE_ENV=production
PORT=10000
```

#### **Optional Variables (Recommended)**
```env
# Redis (for caching - optional but recommended)
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Email (for notifications)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=CAMS Church <noreply@your-domain.com>

# CORS (for frontend)
ALLOWED_ORIGINS=https://your-frontend-domain.com,https://another-domain.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info

# System
ADMIN_DEFAULT_PASSWORD=your-secure-admin-password
SYSTEM_EMAIL=admin@your-domain.com
```

### 2. Render Service Configuration

#### **Build Settings**
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Node Version:** 18+ (set in package.json engines)

#### **Advanced Settings**
- **Auto-Deploy:** Enable for automatic deployments from Git
- **Health Check Path:** `/health`

### 3. Database Setup

#### **MongoDB Atlas (Recommended)**
1. Create account at [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a new cluster
3. Create database user
4. Whitelist `0.0.0.0/0` (all IPs) for Render
5. Get connection string and set as `MONGODB_URI`

#### **Redis (Optional)**
1. Use [Redis Cloud](https://redis.com/redis-enterprise-cloud/) or [Upstash](https://upstash.com/)
2. Create Redis instance
3. Set `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD`

### 4. SMS Service Setup

For SMS notifications, you'll need an SMS provider. The app is configured for SMS Notify Ghana:

1. Sign up at your SMS provider
2. Get API key
3. Set `SMS_API_KEY` and optionally `SMS_SENDER_ID`

### 5. Troubleshooting

#### **Common Issues**

**Bad Gateway (502 Error)**
- Check if all required environment variables are set
- Verify MongoDB URI is correct and accessible
- Check Render service logs for specific errors

**Database Connection Failed**
- Ensure MongoDB Atlas allows connections from `0.0.0.0/0`
- Verify username/password in connection string
- Check if cluster is running

**App Won't Start**
- Check build logs for dependency installation errors
- Verify `npm start` command works locally
- Check Node.js version compatibility

#### **Check Service Health**
- Visit `https://your-app.onrender.com/health` for basic health check
- Visit `https://your-app.onrender.com/health/detailed` for detailed system status

### 6. API Endpoints

Once deployed, your API will be available at:
- **Base URL:** `https://your-app.onrender.com/api/v1`
- **Auth:** `https://your-app.onrender.com/api/v1/auth`
- **Users:** `https://your-app.onrender.com/api/v1/users`
- **Events:** `https://your-app.onrender.com/api/v1/events`
- **Attendance:** `https://your-app.onrender.com/api/v1/attendance`

### 7. Security Notes

- Never commit sensitive environment variables to Git
- Use strong, unique secrets for JWT tokens
- Regularly rotate API keys and passwords
- Monitor logs for suspicious activity

### 8. Performance Optimization

- Enable Redis for better caching performance
- Set appropriate CORS origins (don't use wildcard in production)
- Monitor database performance and add indexes as needed
- Consider upgrading Render plan for better performance

---

## 🆘 Need Help?

If you're still getting errors:

1. Check Render service logs
2. Verify all environment variables are set correctly
3. Test MongoDB connection from external tool
4. Try the `/health/detailed` endpoint for diagnostic information

The app now handles missing connections more gracefully and will start even if Redis fails to connect. 