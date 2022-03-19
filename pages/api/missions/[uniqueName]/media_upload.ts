import { NextApiRequest, NextApiResponse } from "next";

import nextConnect from "next-connect";
import MyMongo from "../../../../lib/mongodb";
import concat from "concat-stream";
import validateUser, {
	CREDENTIAL,
} from "../../../../middleware/check_auth_perms";

import axios from "axios";

import FormData from "form-data";

import { createReadStream } from "fs";

import parseMultipartForm from "../../../../lib/multipartfromparser";

import { postNewMedia } from "../../../../lib/discordPoster";

import { ObjectId } from "mongodb";
import { testImageNode } from "../../../../lib/testImage";
import multer from "multer";
import UploadcareStorage from "../../../../lib/multer-storage-uploadcare";
 
const apiRoute = nextConnect({});

// const storage = multer.memoryStorage();
// apiRoute.use(multer({ storage: storage }).any());
// //apiRoute.use(parseMultipartForm);

apiRoute.use(
	multer({
		storage: UploadcareStorage({
			public_key: process.env.NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY,
			private_key: process.env.NEXT_PUBLIC_UPLOADCARE_SECRET_KEY,
			store: 1, // 'auto' || 0 || 1
		}),
	}).any()
);

apiRoute.use((req, res, next) => validateUser(req, res, CREDENTIAL.ANY, next));

apiRoute.post(async (req: NextApiRequest, res: NextApiResponse) => {
	try {
		const session = req["session"];
		const { uniqueName } = req.query;
		let imgurLinks = [];
		let files = [];

		for (const file of req["files"]) {
			imgurLinks.push({
				_id: new ObjectId(),
				link: file.imgur_link,
				cdnLink: `https://ucarecdn.com/${file.uploadcare_file_id}/${file.originalname}`,
				type: file.mimetype,
				date: new Date(),
				discord_id: session.user["discord_id"],
			});
		}
		let allLinks = [...imgurLinks];
		if (req.body["directLinks"]) {
			const directLinks = [].concat(req.body["directLinks"]);
			let directLinksObjs = [];
			for (const directLink of directLinks) {
				console.log(directLink);
				const type = (await testImageNode(directLink)) ? "image" : "video";
				directLinksObjs.push({
					_id: new ObjectId(),
					link: directLink,
					type: type,
					date: new Date(),
					discord_id: session.user["discord_id"],
				});
			}
			allLinks = [...allLinks, ...directLinksObjs];
		}

		const updateResult = await MyMongo.collection<{}>(
			"missions"
		).findOneAndUpdate(
			{
				uniqueName: uniqueName,
			},
			{
				$addToSet: { media: { $each: allLinks } },
			},
			{ projection: { name: 1 } }
		);

		if (updateResult.ok) {
			const botResponse = await axios.get(
				`http://localhost:3001/users/${session.user["discord_id"]}`
			);

			postNewMedia({
				name: updateResult.value["name"],
				uniqueName: uniqueName,
				mediaLinkList: allLinks,
				mediaAuthor: botResponse.data.nickname ?? botResponse.data.displayName,
				mediaDisplayAvatarURL: botResponse.data.displayAvatarURL,
			});
			return res.status(200).json({ insertedMedia: allLinks });
		} else {
			return res.status(400).json({ error: `An error occurred.` });
		}
	} catch (error) {
		console.log(error);
		return res.status(400).json({ error: error });
	}
});

export const config = {
	api: {
		bodyParser: false,
		//  Disallow body parsing, consume as stream
	},
};
export default apiRoute;
