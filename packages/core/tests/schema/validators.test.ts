import { describe, expect, it } from "vitest";
import { getDefaultValue, validateSchema } from "../../src/schema/validators";
import { schema } from "../../src/schema";

describe("Schema Validators", () => {
  describe("validateSchema", () => {
    it("should validate a simple schema with primitive types", () => {
      const testSchema = schema({
        name: schema.String({ required: true }),
        age: schema.Number(),
        isActive: schema.Boolean({ defaultValue: true }),
      });

      // Valid data
      const validData = {
        name: "John Doe",
        age: 30,
        isActive: false,
      };
      const validResult = validateSchema(testSchema, validData);
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toBeUndefined();

      // Invalid data - missing required field
      const invalidData1 = {
        age: 30,
        isActive: false,
      };
      const invalidResult1 = validateSchema(testSchema, invalidData1);
      expect(invalidResult1.valid).toBe(false);
      expect(invalidResult1.errors).toContain("name: Value is required");

      // Invalid data - wrong type
      const invalidData2 = {
        name: "John Doe",
        age: "30", // String instead of number
        isActive: false,
      };
      const invalidResult2 = validateSchema(testSchema, invalidData2);
      expect(invalidResult2.valid).toBe(false);
      expect(invalidResult2.errors).toContain("age: Value must be a number");
    });

    it("should validate nested schemas", () => {
      const addressSchema = schema.LoroMap({
        street: schema.String({ required: true }),
        city: schema.String({ required: true }),
        zipCode: schema.String(),
      });

      const userSchema = schema({
        name: schema.String({ required: true }),
        address: addressSchema,
      });

      // Valid data
      const validData = {
        name: "John Doe",
        address: {
          street: "123 Main St",
          city: "Anytown",
          zipCode: "12345",
        },
      };
      const validResult = validateSchema(userSchema, validData);
      expect(validResult.valid).toBe(true);

      // Invalid nested data
      const invalidData = {
        name: "John Doe",
        address: {
          street: "123 Main St",
          // Missing required city
        },
      };
      const invalidResult = validateSchema(userSchema, invalidData);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toContain(
        "address: city: Value is required",
      );
    });

    it("should validate LoroList schemas", () => {
      const todosSchema = schema({
        todos: schema.LoroList(schema.LoroMap({
          id: schema.String(),
          text: schema.String({ required: true }),
          completed: schema.Boolean({ defaultValue: false }),
        })),
      });

      // Valid data
      const validData = {
        todos: [
          { id: "1", text: "Buy milk", completed: true },
          { id: "2", text: "Walk the dog", completed: false },
        ],
      };
      const validResult = validateSchema(todosSchema, validData);
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toBeUndefined();

      // Invalid data - missing required field
      const invalidData = {
        todos: [
          { id: "1", text: "Buy milk", completed: true },
          { id: "2", completed: false }, // Missing text
        ],
      };
      const invalidResult = validateSchema(todosSchema, invalidData);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors?.[0]).toContain(
        "todos: Item 1: text: Value is required",
      );
    });

    it("should validate with custom validation functions", () => {
      const userSchema = schema({
        email: schema.String({
          required: true,
          validate: (value) => {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
              "Invalid email format";
          },
        }),
        age: schema.Number({
          validate: (value) => {
            return (value >= 18) || "Must be at least 18 years old";
          },
        }),
      });

      // Valid data
      const validData = {
        email: "test@example.com",
        age: 25,
      };
      const validResult = validateSchema(userSchema, validData);
      expect(validResult.valid).toBe(true);

      // Invalid email format
      const invalidData1 = {
        email: "not-an-email",
        age: 25,
      };
      const invalidResult1 = validateSchema(userSchema, invalidData1);
      expect(invalidResult1.valid).toBe(false);
      expect(invalidResult1.errors).toBeDefined();
      expect(invalidResult1.errors?.[0]).toContain(
        "email: Invalid email format",
      );

      // Invalid age
      const invalidData2 = {
        email: "test@example.com",
        age: 16,
      };
      const invalidResult2 = validateSchema(userSchema, invalidData2);
      expect(invalidResult2.valid).toBe(false);
      expect(invalidResult2.errors).toBeDefined();
      expect(invalidResult2.errors?.[0]).toContain(
        "age: Must be at least 18 years old",
      );
    });

    it("should ignore fields with Ignore schema type", () => {
      const userSchema = schema({
        name: schema.String({ required: true }),
        temporaryData: schema.Ignore(),
      });

      const data = {
        name: "John Doe",
        temporaryData: { anything: "goes here" },
      };

      const result = validateSchema(userSchema, data);
      expect(result.valid).toBe(true);
    });

    it("should validate LoroText schema type", () => {
      const noteSchema = schema({
        title: schema.String({ required: true }),
        content: schema.LoroText(),
      });

      // Valid data
      const validData = {
        title: "My Note",
        content: "This is the content of my note",
      };
      const validResult = validateSchema(noteSchema, validData);
      expect(validResult.valid).toBe(true);

      // Invalid data - wrong type for content
      const invalidData = {
        title: "My Note",
        content: 123, // Number instead of string
      };
      const invalidResult = validateSchema(noteSchema, invalidData);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors).toBeDefined();
      expect(invalidResult.errors?.[0]).toContain(
        "content: Content must be a string",
      );
    });
  });

  describe("getDefaultValue", () => {
    it("should return default values for primitive types", () => {
      const testSchema = schema({
        name: schema.String({ defaultValue: "Unknown" }),
        age: schema.Number({ defaultValue: 0 }),
        isActive: schema.Boolean({ defaultValue: true }),
        noDefault: schema.String(),
      });

      const defaults = getDefaultValue(testSchema);
      expect(defaults).toEqual({
        name: "Unknown",
        age: 0,
        isActive: true,
        noDefault: undefined,
      });
    });

    it("should handle nested default values", () => {
      const addressSchema = schema.LoroMap({
        street: schema.String({ defaultValue: "" }),
        city: schema.String({ defaultValue: "" }),
        country: schema.String({ defaultValue: "USA" }),
      });

      const userSchema = schema({
        name: schema.String({ defaultValue: "Guest" }),
        address: addressSchema,
      });

      const defaults = getDefaultValue(userSchema);
      expect(defaults).toEqual({
        name: "Guest",
        address: {
          street: "",
          city: "",
          country: "USA",
        },
      });
    });

    it("should handle LoroList default values", () => {
      const todoSchema = schema.LoroMap({
        id: schema.String(),
        text: schema.String(),
        completed: schema.Boolean({ defaultValue: false }),
      });

      const todosSchema = schema({
        todos: schema.LoroList(todoSchema, undefined, { defaultValue: [] }),
        emptyTodos: schema.LoroList(todoSchema),
      });

      const defaults = getDefaultValue(todosSchema);
      expect(defaults).toEqual({
        todos: [],
        emptyTodos: [],
      });
    });

    it("should handle complex nested structures", () => {
      const itemSchema = schema.LoroMap({
        id: schema.String(),
        name: schema.String({ defaultValue: "Item" }),
        quantity: schema.Number({ defaultValue: 1 }),
      });

      const categorySchema = schema.LoroMap({
        id: schema.String(),
        name: schema.String({ defaultValue: "Category" }),
        items: schema.LoroList(itemSchema, undefined, { defaultValue: [] }),
      });

      const storeSchema = schema({
        name: schema.String({ defaultValue: "My Store" }),
        categories: schema.LoroList(categorySchema, undefined, {
          defaultValue: [],
        }),
        settings: schema.LoroMap({
          darkMode: schema.Boolean({ defaultValue: false }),
          notifications: schema.Boolean({ defaultValue: true }),
        }),
      });

      const defaults = getDefaultValue(storeSchema);
      expect(defaults).toEqual({
        name: "My Store",
        categories: [],
        settings: {
          darkMode: false,
          notifications: true,
        },
      });
    });
  });
});
