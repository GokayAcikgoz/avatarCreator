using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AvatarForge.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAvatarOwnerProject : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "OwnerProjectId",
                table: "Avatars",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Avatars_OwnerProjectId",
                table: "Avatars",
                column: "OwnerProjectId");

            migrationBuilder.AddForeignKey(
                name: "FK_Avatars_Projects_OwnerProjectId",
                table: "Avatars",
                column: "OwnerProjectId",
                principalTable: "Projects",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Avatars_Projects_OwnerProjectId",
                table: "Avatars");

            migrationBuilder.DropIndex(
                name: "IX_Avatars_OwnerProjectId",
                table: "Avatars");

            migrationBuilder.DropColumn(
                name: "OwnerProjectId",
                table: "Avatars");
        }
    }
}
