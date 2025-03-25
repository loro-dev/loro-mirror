import { Mirror } from "../../src/core/mirror";
import { LoroDoc, LoroText } from "loro-crdt";
import { schema } from "../../src/schema";
import { describe, expect, it } from "vitest";
import { valueIsContainer, valueIsContainerOfType } from "../../src/core/utils";

describe("MovableList", () => {
	// Utility function to wait for sync to complete (three microtasks for better reliability)
	const waitForSync = async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	};

	it("properly initializes container as movable list", async () => {
	  const doc = new LoroDoc();
	  const schema_ = schema({
	    list: schema.LoroMovableList(
	    	schema.LoroMap({
	    		id: schema.String(),
	    		text: schema.LoroText(),
	    	}), (item) => item.id
	    )
	  });

	  const mirror = new Mirror({
	    doc,
	    schema: schema_,
	  });

	  mirror.setState({
	    list: [{
	    	id: "1",
	    	text: "hello",
	    }],
	  })

	  mirror.sync();
	  await waitForSync();

	  let serialized = doc.getDeepValueWithID();

	  expect(
	    valueIsContainerOfType(serialized.list, ":MovableList"),
	    "list field should be a LoroMovableList Container",
	  ).toBeTruthy();

	  expect(
	  	valueIsContainerOfType(serialized.list.value[0], ":Map"),
	  	"list item should be a LoroMap Container",
	  ).toBeTruthy();

	  expect(
	  	valueIsContainerOfType(serialized.list.value[0].value.text, ":Text"),
	  	"list item text should be a LoroText Container",
	  ).toBeTruthy();

	  const id1ContainerId = serialized.list.value[0].cid;

	  mirror.setState({
	  	list: [
	  		{
	  			id: "2",
	  			text: "world",
	  		},
	  		{
	  			id: "1",
	  			text: "hello",
	  		}
	  	],
	  });

	  mirror.sync();

	  await waitForSync();

	  serialized = doc.getDeepValueWithID();

	  expect(
	  	valueIsContainerOfType(serialized.list, ":MovableList"),
	  	"list field should be a LoroMovableList Container",
	  ).toBeTruthy();

	  console.log(serialized.list.value);

	  expect(
	  	serialized.list.value.length,
	  	"list should have two items",
	  ).toBe(2);

	  expect(
	  	serialized.list.value[0].value.id,
	  	"first item should have id 2",
	  ).toBe("2");

	  expect(
	  	serialized.list.value[1].cid,
	  	"first item should have cid 1",
	  ).toBe(id1ContainerId);

	  expect(
	  	valueIsContainerOfType(serialized.list.value[0], ":Map"),
	  	"list item should be a LoroMap Container",
	  ).toBeTruthy();

	  expect(
	  	valueIsContainerOfType(serialized.list.value[0].value.text, ":Text"),
	  	"list item text should be a LoroText Container",
	  ).toBeTruthy();

	  expect(
	  	valueIsContainerOfType(serialized.list.value[1], ":Map"),
	  	"list item should be a LoroMap Container",
	  ).toBeTruthy();

	  expect(
	  	valueIsContainerOfType(serialized.list.value[1].value.text, ":Text"),
	  	"list item text should be a LoroText Container",
	  ).toBeTruthy();

	})

	it("movable list nested in map container", async () => {

		const doc = new LoroDoc();
		const schema_ = schema({
			map: schema.LoroMap({
				children: schema.LoroMovableList(
					schema.LoroMap({
						id: schema.String(),
						text: schema.LoroText()
					}),
					(item) => item.id
				)
			})
		});

		const mirror = new Mirror({
			doc,
			schema: schema_,
		});

		mirror.setState({
			map: {
				children: [
					{
						id: "1",
						text: "hello",
					},
					{
						id: "2",
						text: "world",
					},
				]
			}
		})

		mirror.sync();
		await waitForSync();

		let serialized = doc.getDeepValueWithID();


		expect(
			valueIsContainerOfType(serialized.map, ":Map"),
		).toBeTruthy();

		expect(
			valueIsContainerOfType(serialized.map.value.children, ":MovableList"),
			"list field should be a LoroMovableList Container",
		).toBeTruthy();

		expect(
			valueIsContainerOfType(serialized.map.value.children.value[0], ":Map"),
			"list item should be a LoroMap Container",
		).toBeTruthy();

		expect(
			valueIsContainerOfType(serialized.map.value.children.value[0].value.text, ":Text"),
			"list item text should be a LoroText Container",
		).toBeTruthy();

		console.log(JSON.stringify(serialized, null, 2))

		// Test that updates a nested container works
		mirror.setState({
			map: {
				children: [
					{
						id: "1",
						text: "hello",
					},
					{
						id: "2",
						text: "hello world",
					},
				]
			}
		})

		mirror.sync();
		await waitForSync();

		serialized = doc.getDeepValueWithID();


		expect(
			valueIsContainerOfType(serialized.map.value.children, ":MovableList"),
			"list field should be a LoroMovableList Container",
		).toBeTruthy();

		expect(
			serialized.map.value.children.value.length,
			"list should have two items",
		).toBe(2);

		expect(
			serialized.map.value.children.value[1].value.text.value,
			"first item should have id 2",
		).toBe("hello world");

		// test that inserting an item works
		mirror.setState({
			map: {
				children: [
					{
						id: "1",
						text: "hello",
					},
					{
						id: "2",
						text: "hello world",
					},
					{
						id: "3",
						text: "hello world",
					},
				]
			}
		})

		mirror.sync();
		await waitForSync();

		serialized = doc.getDeepValueWithID();
		console.log(JSON.stringify(serialized, null, 2))

		expect(
			valueIsContainerOfType(serialized.map.value.children, ":MovableList"),
			"list field should be a LoroMovableList Container",
		).toBeTruthy();

		expect(
			serialized.map.value.children.value.length,
			"list should have three items",
		).toBe(3);

		expect(
			serialized.map.value.children.value[2].value.text.value,
			"first item should have id 2",
		).toBe("hello world");


		// test that moving and updating an item works
		mirror.setState({
			map: {
				children: [
					{
						id: "1",
						text: "hello",
					},
					{
						id: "3",
						text: "hello world",
					},
					{
						id: "2",
						text: "hello world 123",
					},
				]
			}
		})

		mirror.sync();
		await waitForSync();

		serialized = doc.getDeepValueWithID();
		console.log(JSON.stringify(serialized, null, 2))
})


});
