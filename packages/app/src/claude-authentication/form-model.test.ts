import { expect, test, vi } from "vitest";
import { openClaudeAuthenticationForm } from "./form-model";

test("saving clears the token and resets the editor without losing the renewal date", async () => {
  const model = openClaudeAuthenticationForm();
  model.setToken("sk-ant-oat01-SYNTHETIC_TEST_ONLY");
  const renewal = model.getState().renewal;
  const save = vi.fn(async () => undefined);
  await model.submit(save);
  expect(save).toHaveBeenCalledWith("sk-ant-oat01-SYNTHETIC_TEST_ONLY", `${renewal}T00:00:00.000Z`);
  expect(model.getState()).toMatchObject({
    token: "",
    saved: true,
    pending: false,
    resetKey: 1,
    renewal,
  });
});

test("failed storage offers a retry and never displays server credential errors", async () => {
  const model = openClaudeAuthenticationForm();
  model.setToken("sk-ant-oat01-SYNTHETIC_TEST_ONLY");
  await model.submit(async () => {
    throw new Error("SECRET_ERROR_CONTENT");
  });
  expect(model.getState().pending).toBe(false);
  expect(model.getState().error).not.toContain("SECRET_ERROR_CONTENT");
  expect(model.getState().token).toBe("sk-ant-oat01-SYNTHETIC_TEST_ONLY");
  model.close();
  expect(model.getState().token).toBe("");
});

test("invalid renewal dates cannot silently roll into another month", async () => {
  const model = openClaudeAuthenticationForm();
  model.setToken("sk-ant-oat01-SYNTHETIC_TEST_ONLY");
  model.setRenewal("2099-02-31");
  const save = vi.fn();
  await model.submit(save);
  expect(save).not.toHaveBeenCalled();
  expect(model.getState().error).toBeTruthy();
});

test("a pending save cannot submit twice", async () => {
  const model = openClaudeAuthenticationForm();
  model.setToken("sk-ant-oat01-SYNTHETIC_TEST_ONLY");
  let finish = () => {};
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = model.submit(save);
  await model.submit(save);
  expect(save).toHaveBeenCalledTimes(1);
  finish();
  await pending;
});
