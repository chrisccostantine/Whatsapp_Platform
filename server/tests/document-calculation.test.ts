import { describe,expect,it,vi } from "vitest";
vi.mock("../src/lib/prisma.js",()=>({prisma:{}}));
const{calculateDocument}=await import("../src/modules/commerce/document.service.js");
describe("commerce calculations",()=>{
  it("calculates line discounts, tax, document discount, and delivery with decimal precision",()=>{const result=calculateDocument([{name:"Item",productId:null,description:null,quantity:2,unitPrice:10,discount:2,taxRate:10}],1,5);expect(result.subtotal.toString()).toBe("18");expect(result.tax.toString()).toBe("1.8");expect(result.total.toString()).toBe("23.8");expect(result.items[0]!.lineTotal.toString()).toBe("19.8");});
  it("rejects discounts larger than the line value",()=>expect(()=>calculateDocument([{name:"Item",productId:null,description:null,quantity:1,unitPrice:10,discount:11,taxRate:0}])).toThrow("Discount exceeds"));
});
