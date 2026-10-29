import express from 'express';
import { runAiTestEndpoint } from '../controllers/aiTestController.js';

const router = express.Router();

// Primary AI Test execution endpoint
router.post('/run', runAiTestEndpoint);

export default router;

