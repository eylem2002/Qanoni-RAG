import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lawChangesRouter from "./admin/law-changes";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin/law-changes", lawChangesRouter);

export default router;
