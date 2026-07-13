import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/response.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { routeParam } from "../../lib/route-param.js";

export const productRouter = Router(); productRouter.use(authenticate);
const productSchema = z.object({ name: z.string().trim().min(1).max(160), sku: z.string().trim().max(80).nullable().optional(), type: z.enum(["PRODUCT", "SERVICE"]), description: z.string().trim().max(2000).nullable().optional(), price: z.coerce.number().nonnegative().max(1_000_000_000), currency: z.enum(["USD", "LBP"]), taxRate: z.coerce.number().min(0).max(100).default(0), isActive: z.boolean().default(true) });

productRouter.get("/", asyncHandler(async (req, res) => { const query=z.object({search:z.string().trim().optional(),type:z.enum(["PRODUCT","SERVICE"]).optional(),active:z.coerce.boolean().optional()}).parse(req.query);const items=await prisma.product.findMany({where:{businessId:req.auth!.businessId,deletedAt:null,...(query.type?{type:query.type}:{}),...(query.active!==undefined?{isActive:query.active}:{}),...(query.search?{OR:[{name:{contains:query.search,mode:"insensitive"}},{sku:{contains:query.search,mode:"insensitive"}}]}:{})},orderBy:{name:"asc"}});return ok(res,items);}));
productRouter.post("/",requireRole("OWNER","ADMIN"),asyncHandler(async(req,res)=>{const input=productSchema.parse(req.body);const item=await prisma.product.create({data:{...input,businessId:req.auth!.businessId,sku:input.sku||null}});return ok(res,item,"Catalog item created",201);}));
productRouter.patch("/:id",requireRole("OWNER","ADMIN"),asyncHandler(async(req,res)=>{const id=routeParam(req.params.id);const existing=await prisma.product.findFirst({where:{id,businessId:req.auth!.businessId,deletedAt:null}});if(!existing)throw new AppError(404,"PRODUCT_NOT_FOUND","Catalog item was not found");const input=productSchema.partial().parse(req.body);const item=await prisma.product.update({where:{id},data:{...input,...(input.sku!==undefined?{sku:input.sku||null}:{})}});return ok(res,item,"Catalog item updated");}));
productRouter.delete("/:id",requireRole("OWNER","ADMIN"),asyncHandler(async(req,res)=>{const id=routeParam(req.params.id);const changed=await prisma.product.updateMany({where:{id,businessId:req.auth!.businessId,deletedAt:null},data:{deletedAt:new Date(),isActive:false}});if(!changed.count)throw new AppError(404,"PRODUCT_NOT_FOUND","Catalog item was not found");return ok(res,null,"Catalog item archived");}));
