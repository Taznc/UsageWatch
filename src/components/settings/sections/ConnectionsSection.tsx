import { useApp } from "../../../context/AppContext";
import { ProviderMethodPicker } from "../../setup/ProviderMethodPicker";

export function ConnectionsSection() {
  const { dispatch } = useApp();
  const onConnected = () => dispatch({ type: "SET_HAS_CREDENTIALS", has: true });

  return (
    <div>
      <ProviderMethodPicker provider="Claude" onConnected={onConnected} />
      <ProviderMethodPicker provider="Codex" onConnected={onConnected} />
      <ProviderMethodPicker provider="Cursor" onConnected={onConnected} />
    </div>
  );
}
