import mongoose from "mongoose";
import nowLocal from "../clock.js";
const usersSchema = new mongoose.Schema(
  {
    login: { type: String, required: true, unique: true },
    secret: { type: String, required: true },
    nickname: { type: String, default: '' },
    accountCode: { type: String, required: true, unique: true },
    displayName: { type: String, required: true },
    avatarUrl: { type: String, default: "" },
    level: { type: Number, required: true },
    active: { type: Number, default: 1 },
    tier: {
      type: String,
      enum: ["free", "silver", "gold", "banned"],
      default: "free",
      index: true,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PartnerModel",
      default: null,
    },
    partnerNumber: { type: String, default: "" },
    certificates: {
      type: [{
        kind: { type: String, required: true },
        code: { type: String, required: true },
      }],
      default: [],
    },
    createdOn: { type: String, default: nowLocal },
    updatedOn: { type: String, default: nowLocal },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

// update updatedOn อัตโนมัติ
usersSchema.pre(['updateOne','findOneAndUpdate','updateMany'], function(){
  this.set({ updatedOn: nowLocal() });
});

usersSchema.pre('save', function(){
  this.updatedOn = nowLocal();
});

const User = mongoose.model("UserModel", usersSchema, "users");

export default User;
