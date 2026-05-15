import { v4 as uuidv4 } from "uuid";

export const getDeviceId = () => {
  let id = localStorage.getItem("device_id");
  if (!id) {
    id = uuidv4();
    localStorage.setItem("device_id", id);
  }
  return id;
};
