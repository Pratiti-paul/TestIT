import { Router } from 'express';
import {
  getTestSchema,
  validateDefinition,
  executeTest,
} from '../controllers/functionalTestController.js';

const router = Router();

router.get('/schema', getTestSchema);
router.post('/validate', validateDefinition);
router.post('/execute', executeTest);

export default router;

