import { Router } from "express";
import * as controller from "./controller";

const router = Router();

router.get("/retrieve", controller.retrieve);

export default router;
