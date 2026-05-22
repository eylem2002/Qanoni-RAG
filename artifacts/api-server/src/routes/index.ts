import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lawChangesRouter from "./admin/law-changes";
import ragRouter from "./rag";
import { adminAuth } from "../lib/admin-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/rag", ragRouter);
router.use("/admin", adminAuth);
router.use("/admin/law-changes", lawChangesRouter);

export default router;
