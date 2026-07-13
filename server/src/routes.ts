import { Router } from "express";
import { authRouter } from "./modules/auth/auth.routes.js";
import { businessRouter } from "./modules/business/business.routes.js";
import { customerRouter } from "./modules/customers/customer.routes.js";
import { tagRouter } from "./modules/tags/tag.routes.js";
import { followUpRouter } from "./modules/follow-ups/follow-up.routes.js";
import { pipelineRouter } from "./modules/pipeline/pipeline.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";

export const apiRouter = Router();
apiRouter.use("/auth", authRouter);
apiRouter.use("/business", businessRouter);
apiRouter.use("/customers", customerRouter);
apiRouter.use("/tags", tagRouter);
apiRouter.use("/follow-ups", followUpRouter);
apiRouter.use("/pipeline", pipelineRouter);
apiRouter.use("/dashboard", dashboardRouter);

