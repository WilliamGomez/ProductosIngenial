import { ThreeDot } from "react-loading-indicators";

export const Spinner = () => {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <ThreeDot color='#041C43' size='medium' text='' textColor='' />
    </div>
  );
};
