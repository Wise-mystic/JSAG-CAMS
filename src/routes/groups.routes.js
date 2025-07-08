const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/rbac.middleware');
const { USER_ROLES } = require('../utils/constants');
const EventService = require('../services/event.service');
const { ApiError } = require('../middleware/error.middleware');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const router = express.Router();

// Apply authentication to all group routes
router.use(authenticate);

// GET /groups/:type/:id/subgroups - Get subgroups for a parent group
router.get('/:type/:id/subgroups',
  authorize({
    permission: 'events:read',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER,
      USER_ROLES.CLOCKER
    ]
  }),
  async (req, res, next) => {
    try {
      const { type, id } = req.params;
      
      // Validate path parameters
      if (!['department', 'ministry', 'prayer-tribe'].includes(type)) {
        return next(ApiError.badRequest('Invalid group type. Must be: department, ministry, or prayer-tribe'));
      }
      
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return next(ApiError.badRequest('Invalid group ID format'));
      }
      
      const subgroups = await EventService.getSubgroupsForParent(
        type,
        id,
        req.user.id,
        req.user.role
      );

      res.status(200).json({
        success: true,
        data: {
          parentType: type,
          parentId: id,
          subgroups
        }
      });
    } catch (error) {
      logger.error('Get subgroups failed', {
        error: error.message,
        parentType: req.params.type,
        parentId: req.params.id,
        userId: req.user.id
      });
      next(error);
    }
  }
);

// GET /groups/available - Get available groups for current user
router.get('/available',
  authorize({
    permission: 'events:create',
    allowedRoles: [
      USER_ROLES.SUPER_ADMIN, 
      USER_ROLES.SENIOR_PASTOR, 
      USER_ROLES.ASSOCIATE_PASTOR, 
      USER_ROLES.PASTOR, 
      USER_ROLES.DEPARTMENT_LEADER,
      USER_ROLES.CLOCKER
    ]
  }),
  async (req, res, next) => {
    try {
      const availableGroups = await EventService.getAvailableGroupsForEventCreation(req.user.id);

      res.status(200).json({
        success: true,
        data: availableGroups
      });
    } catch (error) {
      logger.error('Get available groups failed', {
        error: error.message,
        userId: req.user.id
      });
      next(error);
    }
  }
);

module.exports = router; 