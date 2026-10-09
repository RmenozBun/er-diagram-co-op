import mongoose from "mongoose";
import nowInBangkok from "../timezone.js";
const usersSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    hint: { type: String, default: '' },
    CustomerID: { type: String, required: true, unique: true },
    fullname: { type: String, required: true },
    profileImage: { type: String, default: "" },
    role: { type: Number, required: true },
    isActive: { type: Number, default: 1 },
    membershipStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
      index: true,
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MemberModel",
      default: null,
    },
    memberNumber: { type: String, default: "" },
    licenseNumbers: {
      type: [{
        professionType: { type: String, required: true },
        licenseNumber: { type: String, required: true },
      }],
      default: [],
    },
    createAt: { type: String, default: nowInBangkok },
    updateAt: { type: String, default: nowInBangkok },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

// update updateAt อัตโนมัติ
usersSchema.pre(['updateOne','findOneAndUpdate','updateMany'], function(){
  this.set({ updateAt: nowInBangkok() });
});

usersSchema.pre('save', function(){
  this.updateAt = nowInBangkok();
});

const User = mongoose.model("UserModel", usersSchema, "users");

export default User;
