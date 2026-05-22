import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lawChangesRouter from "./admin/law-changes";
import { adminAuth } from "../lib/admin-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin", adminAuth);
router.use("/admin/law-changes", lawChangesRouter);

export default router;
