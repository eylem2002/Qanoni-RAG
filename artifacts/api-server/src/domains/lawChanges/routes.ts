import { Router } from "express";
import * as controller from "./controller";

const router = Router();

router.get("/status", controller.getStatus);
router.post("/sync", controller.triggerSync);
router.get("/pending", controller.getPending);
router.post("/:changeId/acknowledge", controller.acknowledge);
router.get("/history", controller.getHistory);
router.post("/cleanup-false-positives", controller.cleanup);
router.get("/laws", controller.getLaws);

export default router;
