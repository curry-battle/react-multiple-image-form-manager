import { useState } from "react";
import { ProfileForm } from "./components/ProfileForm";
import { generateUUIDv7 } from "./libs/Uuid";
import type { UserProfile } from "./types/UserProfile";

function App() {
	const [hasDefaultImages, setHasDefaultImages] = useState(true);

	// サンプルの既存データ（実際の使用時はAPIから取得）
	const sampleData: Partial<UserProfile> = {
		id: generateUUIDv7(),
		name: "サンプルユーザー",
		profileImages: [
			{
				id: generateUUIDv7(),
				tempId: "existing_1",
				previewUrl: "https://picsum.photos/500?hmac=example",
				uploadedUrl: "https://picsum.photos/500?hmac=example",
				status: "existing",
			},
			{
				id: generateUUIDv7(),
				tempId: "existing_2",
				previewUrl: "https://picsum.photos/500?hmac=example2",
				uploadedUrl: "https://picsum.photos/500?hmac=example2",
				status: "existing",
			},
		],
	};

	// 空データ
	const emptyData: Partial<UserProfile> = {
		id: generateUUIDv7(),
		name: "サンプルユーザー",
		profileImages: [],
	};

	return (
		<main className="min-h-screen bg-gray-50 p-8">
			<h1 className="text-3xl font-bold text-center mb-4">
				Form with Multiple Image Uploads Example
			</h1>
			<p className="text-center mb-8">React Hook Form & Zod</p>

			<div className="flex justify-center items-center mb-6">
				<ToggleButton
					checked={hasDefaultImages}
					onChange={() => setHasDefaultImages((prev) => !prev)}
					label={`デフォルト画像データ${hasDefaultImages ? "あり" : "なし"}`}
				/>
			</div>
			<ProfileForm
				// デフォルト画像有無の変更時に再レンダリングをかけるためのキー
				key={hasDefaultImages ? "default" : "empty"}
				initialData={hasDefaultImages ? sampleData : emptyData}
			/>
		</main>
	);
}

export default App;

const ToggleButton = ({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: () => void;
	label?: string;
}) => (
	<label className="flex items-center gap-3 cursor-pointer select-none">
		{label && <span className="text-gray-700">{label}</span>}
		<button
			type="button"
			aria-pressed={checked}
			onClick={onChange}
			className={`relative w-12 h-7 rounded-full transition-colors duration-200 focus:outline-none ${checked ? "bg-blue-500" : "bg-gray-300"}`}
		>
			<span
				className={`absolute left-1 top-1 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? "translate-x-5" : ""}`}
			/>
		</button>
	</label>
);
