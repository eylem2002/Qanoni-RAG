import { Router, type IRouter } from "express";
import healthRouter from "./health.routes";
import ragRouter from "../../domains/rag/routes";
import lawChangesRouter from "../../domains/lawChanges/routes";
import { adminAuth } from "../middlewares";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/rag", ragRouter);
router.use("/admin", adminAuth);
router.use("/admin/law-changes", lawChangesRouter);

export default router;
