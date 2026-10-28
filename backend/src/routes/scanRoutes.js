import { Router } from 'express';
import { previewScan } from '../controllers/scanController.js';

const router = Router();

router.post('/preview', previewScan);

export default router;

